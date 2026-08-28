const { app } = require("electron");
const { start } = require("./dist/main-bundle.js");

if (process.platform === "linux") {
    app.setDesktopName("musicpenguin.desktop");
}

app.whenReady().then(start);
