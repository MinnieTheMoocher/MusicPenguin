const { app } = require("electron");
const { start } = require("./dist/main-bundle.js");

app.whenReady().then(start);
