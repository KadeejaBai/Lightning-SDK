const child_process = require("child_process");
const rollup = require('rollup');
const fs = require("fs");
const babel = require("@babel/core");
const babelPresetEnv = require("@babel/preset-env");
const path = require("path");

const dir = __dirname + "/..";

const LNG_PATH = require.resolve('wpe-lightning/dist/lightning-web.js');
//const LNG_SPARK_PATH = require.resolve('wpe-lightning-spark/dist/lightning-spark.js');

const info = {};
getName()
    .then(() => ensureDir())
    .then(() => copySkeleton())
    .then(() => copySparkSkeleton())
    .then(() => ensureSrcDirs())
    .then(() => copyLightning())
    .then(() => copyLightningSpark())
    .then(() => copyMetadata())
    .then(() => copyUxFiles())
    .then(() => copyAppFiles())
    .then(() => bundleUx())
    .then(() => bundleApp())
    .then(() => bundleSparkStartup())
    .then(() => babelify())
    .then(() => console.log('Web release created! ' + process.cwd() + "/dist/" + info.dest))
    .then(() => console.log('(Use a static web server to host it)'))
    .catch(err => {
        console.error(err);
        process.exit(-1)
    });

function getName() {
    return new Promise((resolve, reject) => {
        fs.readFile("./metadata.json", function(err, res) {
            if (err) {
                return reject(new Error("Metadata.json file can't be read: run this from a directory containing a metadata file."));
            }

            const contents = res.toString();
            info.data = JSON.parse(contents);

            if (!info.data.identifier) {
                return reject(new Error("Can't find identifier in metadata.json file"));
            }

            info.identifier = info.data.identifier;

            return resolve();
        });
    });
}


function ensureDir() {
    info.dest = "web-spark";
    return exec("rm -rf ./dist/" + info.dest).then(() => exec("mkdir -p ./dist"));
}

function copySkeleton() {
    return exec("cp -r " + dir + "/dist/web ./dist/web-spark");
}

function copySparkSkeleton() {
    return exec("cp -r " + dir + "/dist/web-spark ./dist/");
}

function copyMetadata() {
    return exec("cp -r ./metadata.json ./dist/" + info.dest);
}

function copyUxFiles() {
    return exec("cp -r " + dir + "/static-ux ./dist/" + info.dest);
}

function copyLightning() {
    return exec("cp -r " + LNG_PATH + " ./dist/" + info.dest + "/js/src/");
}

function copyLightningSpark() {
    //return exec("cp -r " + LNG_SPARK_PATH + " ./dist/" + info.dest + "/spark/");

    /**
     * things a little bit different for Spark...
     * For now we avoid adding "wpe-lightning-spark" in package.json, so doing it in place.
     */
    const dir = `./dist/${info.dest}/tmp`;
    const src = `${dir}/node_modules/wpe-lightning-spark/dist/lightning-spark.js`;
    const dst = `./dist/${info.dest}/spark/`;
    const pkg = {
        "name": "tmp",
        "version": "0.0.1",
        "dependencies": {
            "wpe-lightning-spark": "https://github.com/pxscene/Lightning-Spark.git",
            "rollup-plugin-node-resolve": "^5.0.0"
        }
    };
    return exec(`mkdir -p ${dir}`)
        .then(() => fs.writeFileSync(`${dir}/package.json`, JSON.stringify(pkg)))
        .then(() => exec(`npm --prefix ${dir} install ${dir}`))
        .then(() => exec(`cp ${src} ${dst}`))
        .finally(() => exec(`rm -rf ${dir}`));
}

function copyAppFiles() {
    if (fs.existsSync("./static")) {
        return exec("cp -r ./static ./dist/" + info.dest);
    } else {
        return Promise.resolve();
    }
}

function bundleApp() {
    console.log("Generate rollup bundle for app (src/App.js)");
    return rollup.rollup({input: "./src/App.js"}).then(bundle => {
        return bundle.generate({format: 'iife', name: "appBundle"}).then(content => {
            const location = "./dist/" + info.dest + "/js/src/appBundle.js";
            fs.writeFileSync(location, content.code);
        });
    });
}

function bundleUx() {
    console.log("Generate rollup bundle for ux");
    return rollup.rollup({input: dir + "/js/src/ux.js"}).then(bundle => {
        return bundle.generate({format: 'iife', name: "ux"}).then(content => {
            const location = "./dist/" + info.dest + "/js/src/ux.js";
            fs.writeFileSync(location, content.code);
        });
    });
}

function bundleSparkStartup() {
    console.log("Generate startup file for Spark");
    const glob = {
        "node-fetch": "fetch",
        "wpe-lightning-spark": "lng",
    };
    glob[path.resolve(dir, "dist/spark", "./src/ux.mjs")] = "ux";
    glob[path.resolve(dir, "dist/spark", "./src/app.mjs")] = "appBundle";
    return rollup.rollup({
        input: dir + "/dist/spark/start.mjs",
        external: [
            "node-fetch",
            "wpe-lightning-spark",
            "./src/ux.mjs",
            "./src/app.mjs"
        ]
    }).then(bundle => {
        return bundle.generate({
            format: 'iife',
            globals: glob,
            banner:
              'eval.call(null, require(\'fs\').readFileSync(__dirname + \'/js/src/ux.js\').toString(\'utf8\'));\n' +
              'eval.call(null, require(\'fs\').readFileSync(__dirname + \'/js/src/appBundle.js\').toString(\'utf8\'));\n'
        }).then(content => {
            const location = "./dist/" + info.dest + "/start.js";
            fs.writeFileSync(location, content.code);
        });
    });
}

function ensureSrcDirs() {
    return Promise.all([
        exec("mkdir -p ./dist/" + info.dest + "/js/src"),
        exec("mkdir -p ./dist/" + info.dest + "/js/src.es5")
    ]);
}

function babelify() {
    return Promise.all([
        babelifyFile("./dist/" + info.dest + "/js/src/appBundle.js", "./dist/" + info.dest + "/js/src.es5/appBundle.js"),
        babelifyFile("./dist/" + info.dest + "/js/src/lightning-web.js", "./dist/" + info.dest + "/js/src.es5/lightning-web.js"),
        babelifyFile("./dist/" + info.dest + "/js/src/ux.js", "./dist/" + info.dest + "/js/src.es5/ux.js")
    ])
}
function babelifyFile(inputFile, outputFile) {
    console.log("babelify " + inputFile);
    return new Promise((resolve, reject) => {
        babel.transformFile(inputFile, {presets: [babelPresetEnv]}, function(err, result) {
            if (err) {
                return reject(err);
            }

            fs.writeFileSync(outputFile, result.code);

            resolve();
        });
    });
}

function exec(command, opts) {
    return new Promise((resolve, reject) => {
        console.log("EXECUTE: " + command);
        child_process.exec(command, opts, function(err, stdout, stderr) {
            if (err) {
                return reject(err);
            }

            console.log(stdout);
            console.warn(stderr);
            resolve(stdout);
        });
    });
}