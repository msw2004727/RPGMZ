//=============================================================================
// main.js v1.10.0
//=============================================================================

const scriptUrls = [
    "js/libs/pixi.js",
    "js/libs/pako.min.js",
    "js/libs/localforage.min.js",
    "js/libs/effekseer.min.js",
    "js/libs/vorbisdecoder.js",
    "js/rmmz_core.js",
    "js/rmmz_managers.js",
    "js/rmmz_objects.js",
    "js/rmmz_scenes.js",
    "js/rmmz_sprites.js",
    "js/rmmz_windows.js",
    "js/plugins.js"
];
const effekseerWasmUrl = "js/libs/effekseer.wasm";

class Main {
    constructor() {
        this.xhrSucceeded = false;
        this.loadCount = 0;
        this.error = null;
    }

    run() {
        this.showLoadingSpinner();
        this.testXhr();
        this.hookNwjsClose();
        this.loadMainScripts();
    }

    showLoadingSpinner() {
        const loadingSpinner = document.createElement("div");
        const loadingSpinnerImage = document.createElement("div");
        loadingSpinner.id = "loadingSpinner";
        loadingSpinnerImage.id = "loadingSpinnerImage";
        loadingSpinner.appendChild(loadingSpinnerImage);
        document.body.appendChild(loadingSpinner);
    }

    eraseLoadingSpinner() {
        const loadingSpinner = document.getElementById("loadingSpinner");
        if (loadingSpinner) {
            document.body.removeChild(loadingSpinner);
        }
    }

    testXhr() {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", document.currentScript.src);
        xhr.onload = () => (this.xhrSucceeded = true);
        xhr.send();
    }

    hookNwjsClose() {
        // [Note] When closing the window, the NW.js process sometimes does
        //   not terminate properly. This code is a workaround for that.
        if (typeof nw === "object") {
            nw.Window.get().on("close", () => nw.App.quit());
        }
    }

    loadMainScripts() {
        for (const url of scriptUrls) {
            const script = document.createElement("script");
            script.type = "text/javascript";
            script.src = url;
            script.async = false;
            script.defer = true;
            script.onload = this.onScriptLoad.bind(this);
            script.onerror = this.onScriptError.bind(this);
            script._url = url;
            document.body.appendChild(script);
        }
        this.numScripts = scriptUrls.length;
        window.addEventListener("load", this.onWindowLoad.bind(this));
        window.addEventListener("error", this.onWindowError.bind(this));
    }

    onScriptLoad() {
        if (++this.loadCount === this.numScripts) {
            this.applyResponsiveScreenPatch();
            PluginManager.setup($plugins);
        }
    }

    onScriptError(e) {
        this.printError("Failed to load", e.target._url);
    }

    printError(name, message) {
        this.eraseLoadingSpinner();
        if (!document.getElementById("errorPrinter")) {
            const errorPrinter = document.createElement("div");
            errorPrinter.id = "errorPrinter";
            errorPrinter.innerHTML = this.makeErrorHtml(name, message);
            document.body.appendChild(errorPrinter);
        }
    }

    makeErrorHtml(name, message) {
        const nameDiv = document.createElement("div");
        const messageDiv = document.createElement("div");
        nameDiv.id = "errorName";
        messageDiv.id = "errorMessage";
        nameDiv.innerHTML = name;
        messageDiv.innerHTML = message;
        return nameDiv.outerHTML + messageDiv.outerHTML;
    }

    onWindowLoad() {
        if (!this.xhrSucceeded) {
            const message = "Your browser does not allow to read local files.";
            this.printError("Error", message);
        } else if (this.isPathRandomized()) {
            const message = "Please move the Game.app to a different folder.";
            this.printError("Error", message);
        } else if (this.error) {
            this.printError(this.error.name, this.error.message);
        } else {
            this.initEffekseerRuntime();
        }
    }

    onWindowError(event) {
        if (!this.error) {
            this.error = event.error;
        }
    }

    isPathRandomized() {
        // [Note] We cannot save the game properly when Gatekeeper Path
        //   Randomization is in effect.
        return (
            typeof process === "object" &&
            process.mainModule.filename.startsWith("/private/var")
        );
    }

    initEffekseerRuntime() {
        const onLoad = this.onEffekseerLoad.bind(this);
        const onError = this.onEffekseerError.bind(this);
        effekseer.initRuntime(effekseerWasmUrl, onLoad, onError);
    }

    applyResponsiveScreenPatch() {
        if (this._responsiveScreenPatched || typeof Scene_Boot !== "function") {
            return;
        }

        this._responsiveScreenPatched = true;

        const boxMargin = 4;
        const longSideBase = 1280;
        const maxPortraitMapZoom = 1.5;
        const minVisibleMapTilesX = 8.5;
        const normalizeSize = value => Math.max(240, Math.round(value / 2) * 2);
        const viewportSize = () => ({
            width: Math.max(
                window.innerWidth || document.documentElement.clientWidth || longSideBase,
                1
            ),
            height: Math.max(
                window.innerHeight || document.documentElement.clientHeight || longSideBase,
                1
            )
        });
        const calculateResponsiveSize = dataSystem => {
            const advanced = dataSystem?.advanced ?? {};
            const baseWidth = Number(advanced.screenWidth) || 720;
            const baseHeight = Number(advanced.screenHeight) || 1280;
            const viewport = viewportSize();
            const longSide = Math.max(baseWidth, baseHeight, longSideBase);

            if (viewport.height >= viewport.width) {
                return {
                    width: normalizeSize(longSide * (viewport.width / viewport.height)),
                    height: normalizeSize(longSide)
                };
            }

            return {
                width: normalizeSize(longSide),
                height: normalizeSize(longSide * (viewport.height / viewport.width))
            };
        };
        const isPortraitViewport = () => {
            const viewport = viewportSize();
            return viewport.height >= viewport.width;
        };
        const currentZoomState = () => {
            if (typeof $gameScreen !== "object" || !$gameScreen) {
                return null;
            }

            const scale = Number($gameScreen.zoomScale()) || 1;
            const shake = Math.round(Number($gameScreen.shake()) || 0);
            return {
                scale,
                x: Math.round(-$gameScreen.zoomX() * (scale - 1)) + shake,
                y: Math.round(-$gameScreen.zoomY() * (scale - 1))
            };
        };
        const translateZoomedCoordinate = (value, axis) => {
            const zoom = currentZoomState();
            if (!zoom || zoom.scale <= 1) {
                return value;
            }

            const offset = axis === "x" ? zoom.x : zoom.y;
            return (value - offset) / zoom.scale;
        };
        const calculateMapZoom = () => {
            if (
                !isPortraitViewport() ||
                typeof $gameMap !== "object" ||
                !$gameMap ||
                typeof Graphics !== "object"
            ) {
                return 1;
            }

            const tileWidth = Number($gameMap.tileWidth()) || 0;
            const tileHeight = Number($gameMap.tileHeight()) || 0;
            if (tileWidth <= 0 || tileHeight <= 0) {
                return 1;
            }

            const visibleTilesX = Graphics.width / tileWidth;
            const visibleTilesY = Graphics.height / tileHeight;
            const targetHeightZoom =
                (visibleTilesY / Math.max(Number($gameMap.height()) || 1, 1)) * 0.75;
            const widthLimitedZoom = visibleTilesX / minVisibleMapTilesX;

            return Math.max(
                1,
                Math.min(maxPortraitMapZoom, widthLimitedZoom, targetHeightZoom)
            );
        };
        const applyMapZoom = scale => {
            if (typeof $gameScreen !== "object" || !$gameScreen) {
                return;
            }

            $gameScreen.setZoom(Graphics.width / 2, Graphics.height / 2, scale);
        };

        Scene_Boot.prototype.resizeScreen = function() {
            const { width, height } = calculateResponsiveSize(window.$dataSystem);
            Graphics.resize(width, height);
            Graphics.defaultScale = this.screenScale();
            Graphics.boxWidth = width - boxMargin * 2;
            Graphics.boxHeight = height - boxMargin * 2;
            this.adjustWindow();
        };

        const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
        Scene_Map.prototype.onMapLoaded = function() {
            _Scene_Map_onMapLoaded.call(this);
            this.refreshResponsiveMapZoom();
        };

        Scene_Map.prototype.refreshResponsiveMapZoom = function() {
            applyMapZoom(calculateMapZoom());
        };

        const _Game_Map_canvasToMapX = Game_Map.prototype.canvasToMapX;
        Game_Map.prototype.canvasToMapX = function(x) {
            return _Game_Map_canvasToMapX.call(
                this,
                translateZoomedCoordinate(x, "x")
            );
        };

        const _Game_Map_canvasToMapY = Game_Map.prototype.canvasToMapY;
        Game_Map.prototype.canvasToMapY = function(y) {
            return _Game_Map_canvasToMapY.call(
                this,
                translateZoomedCoordinate(y, "y")
            );
        };
    }

    onEffekseerLoad() {
        this.eraseLoadingSpinner();
        SceneManager.run(Scene_Boot);
    }

    onEffekseerError() {
        this.printError("Failed to load", effekseerWasmUrl);
    }
}

const main = new Main();
main.run();

//-----------------------------------------------------------------------------
