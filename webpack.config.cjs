const path = require('path');

const isProduction = process.env.NODE_ENV == 'production';

const config = {
    entry: './src/browser/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'modelscript.js',
        library: "ModelScript",
        libraryTarget: "umd"
    },
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/i,
                loader: 'ts-loader',
                exclude: ['/node_modules/'],
            }
        ]
    },
    resolve: {
        extensions: ['.ts'],
        extensionAlias: {
            ".js": [".ts", ".js"],
        },
        fallback: {
            'fs': false,
            'path': false
        }
    },
};

module.exports = () => {
    if (isProduction) {
        config.mode = 'production';
    } else {
        config.mode = 'development';
    }
    return config;
};
