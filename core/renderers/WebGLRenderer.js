import * as Log from "../util/logging";
import {perfLogger} from "../util/performance-logger";

export class WebGLRenderer {
    static vertexShaderSource = `
    attribute vec2 xy;
    varying highp vec2 uv;

    void main(void) {
      gl_Position = vec4(xy, 0.0, 1.0);
      uv = vec2((1.0 + xy.x) * 0.5, (1.0 - xy.y) * 0.5);
    }
  `;

    static fragmentShaderSource = `
    varying highp vec2 uv;
    uniform sampler2D texture;

    void main(void) {
      gl_FragColor = texture2D(texture, uv);
    }
  `;

    constructor(canvas2D, gl, webglCanvas) {
        this._canvas2D = canvas2D;
        this.gl = gl;
        this._webglCanvas = webglCanvas;
        this._lastWidth = 0;
        this._lastHeight = 0;
        this._isWebGL2 = gl instanceof WebGL2RenderingContext;

        // Dedicated watermark canvas above WebGL canvas (z-index: 2) so the
        // watermark is always visible regardless of video content on the 2D canvas
        this._watermarkCanvas = document.createElement('canvas');
        this._watermarkCanvas.width = 0;
        this._watermarkCanvas.height = 0;
        this._watermarkCanvas.style.position = 'absolute';
        this._watermarkCanvas.style.left = '0';
        this._watermarkCanvas.style.top = '0';
        this._watermarkCanvas.style.pointerEvents = 'none';
        this._watermarkCanvas.style.zIndex = '2';
        this._watermarkCanvas.style.width = '0px';
        this._watermarkCanvas.style.height = '0px';
        this._watermarkCtx = this._watermarkCanvas.getContext('2d');
        if (webglCanvas.parentNode) {
            // The watermark canvas is absolutely positioned; it must be contained
            // by a positioned ancestor to align with the WebGL canvas. If the
            // direct parent is position:static, warn so the DOM can be fixed.
            const parent = webglCanvas.parentNode;
            if (parent instanceof Element) {
                const parentPos = window.getComputedStyle(parent).position;
                if (parentPos === 'static') {
                    Log.Warn('WebGLRenderer: parent element uses position:static; ' +
                        'watermark overlay may be misaligned. Expected relative/absolute/fixed.');
                }
            }
            parent.appendChild(this._watermarkCanvas);
        }

        this._logWebGLInfo(gl);
        this._initShaders(gl);
        this._initGeometry(gl);
        this._initTexture(gl);
        this._configureGLState(gl, webglCanvas);
    }

    _logWebGLInfo(gl) {
        Log.Info("WebGL Renderer Initialized");
        Log.Info(`WebGL Version: ${gl.getParameter(gl.VERSION)}`);
        Log.Info(`WebGL2: ${this._isWebGL2}`);
        Log.Info(`WebGL Color: ${gl.getParameter(gl.RED_BITS)}, ${gl.getParameter(gl.GREEN_BITS)}, ${gl.getParameter(gl.BLUE_BITS)}, ${gl.getParameter(gl.ALPHA_BITS)}`);
        Log.Info(`WebGL Depth: ${gl.getParameter(gl.DEPTH_BITS)}, Stencil: ${gl.getParameter(gl.STENCIL_BITS)}`);
        Log.Info(`WebGL GLSL Version: ${gl.getParameter(gl.SHADING_LANGUAGE_VERSION)}`);
        Log.Info(`WebGL Vendor: ${gl.getParameter(gl.VENDOR)}`);
        Log.Info(`WebGL Renderer: ${gl.getParameter(gl.RENDERER)}`);
        Log.Info(`WebGL Max Texture Size: ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);
        Log.Info(`WebGL Max Vertex Attrib: ${gl.getParameter(gl.MAX_VERTEX_ATTRIBS)}`);
        Log.Info(`WebGL Extensions: ${gl.getSupportedExtensions()}`);
    }

    _initShaders(gl) {
        const vertexShader = this._compileShader(gl, gl.VERTEX_SHADER, WebGLRenderer.vertexShaderSource);
        const fragmentShader = this._compileShader(gl, gl.FRAGMENT_SHADER, WebGLRenderer.fragmentShaderSource);

        this.shaderProgram = gl.createProgram();
        gl.attachShader(this.shaderProgram, vertexShader);
        gl.attachShader(this.shaderProgram, fragmentShader);
        gl.linkProgram(this.shaderProgram);

        if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
            const errorLog = gl.getProgramInfoLog(this.shaderProgram);
            throw new Error(`Shader program linking failed: ${errorLog}`);
        }

        gl.useProgram(this.shaderProgram);

        // Clean up shaders after linking
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
    }

    _initGeometry(gl) {
        // Reusable vertex buffer
        const vertices = new Float32Array([
            -1.0, -1.0,
            -1.0, +1.0,
            +1.0, +1.0,
            +1.0, -1.0
        ]);

        this._vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const xyLocation = gl.getAttribLocation(this.shaderProgram, "xy");
        gl.vertexAttribPointer(xyLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(xyLocation);

        // Cache attribute location for potential future use
        this._xyLocation = xyLocation;
    }

    _initTexture(gl) {
        this._texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._texture);

        // Use NEAREST for pixel-perfect rendering if applicable, or LINEAR for smoothing
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    _configureGLState(gl, webglCanvas) {
        // Disable unnecessary features
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.DITHER);
        gl.disable(gl.BLEND);

        // Set initial viewport
        gl.viewport(0, 0, webglCanvas.width, webglCanvas.height);
    }

    // Getters/Setters with minimal overhead
    get width() {
        return this._canvas2D.width;
    }

    get height() {
        return this._canvas2D.height;
    }

    get enableCanvasBuffer() {
        return this._canvas2D.enableCanvasBuffer;
    }

    set enableCanvasBuffer(value) {
        this._canvas2D.enableCanvasBuffer = value;
    }

    get antiAliasing() {
        return this._canvas2D.antiAliasing;
    }

    set antiAliasing(value) {
        this._canvas2D.antiAliasing = value;
    }

    get transparentOverlayImg() {
        return this._canvas2D.transparentOverlayImg;
    }

    set transparentOverlayImg(value) {
        this._canvas2D.transparentOverlayImg = value;
        this._canvas2D.enableCanvasBuffer = true;
    }

    get transparentOverlayRect() {
        return this._canvas2D.transparentOverlayRect;
    }

    set transparentOverlayRect(value) {
        this._canvas2D.transparentOverlayRect = value;
    }

    _compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const shaderType = type === gl.VERTEX_SHADER ? "Vertex" : "Fragment";
            const errorLog = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`${shaderType} shader compilation failed: ${errorLog}`);
        }

        return shader;
    }

    // Delegate methods
    drawTransparentOverlayImg() {
        const img = this._canvas2D.transparentOverlayImg;
        const rect = this._canvas2D.transparentOverlayRect;
        const target = this._canvas2D._target;
        if (!img || !rect) {
            if (this._watermarkCtx && target) {
                this._watermarkCtx.clearRect(0, 0, target.width, target.height);
            }
            return;
        }

        const fbWidth = target.width;
        const fbHeight = target.height;
        if (this._watermarkCanvas.width !== fbWidth || this._watermarkCanvas.height !== fbHeight) {
            this._watermarkCanvas.width = fbWidth;
            this._watermarkCanvas.height = fbHeight;
        }
        // Keep CSS size in sync with the target canvas on every draw so the
        // overlay is visible even if drawTransparentOverlayImg runs before any
        // resize/rescale/viewportChangeSize has had a chance to sync styles.
        const targetStyle = target.style;
        if (this._watermarkCanvas.style.width !== targetStyle.width) {
            this._watermarkCanvas.style.width = targetStyle.width;
        }
        if (this._watermarkCanvas.style.height !== targetStyle.height) {
            this._watermarkCanvas.style.height = targetStyle.height;
        }
        this._watermarkCtx.clearRect(0, 0, fbWidth, fbHeight);
        if (img.width !== rect.width || img.height !== rect.height) {
            this._watermarkCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
        } else {
            this._watermarkCtx.drawImage(img, rect.x, rect.y);
        }
    }

    viewportChangeSize(width, height) {
        const result = this._canvas2D.viewportChangeSize(width, height);
        const targetStyle = this._canvas2D._target.style;
        this._watermarkCanvas.style.width = targetStyle.width;
        this._watermarkCanvas.style.height = targetStyle.height;
        return result;
    }

    rescale(factor, width, height, serverWidth, serverHeight, viewPortWidth) {
        this._canvas2D.rescale(factor, width, height, serverWidth, serverHeight, viewPortWidth);
        const targetStyle = this._canvas2D._target.style;
        this._watermarkCanvas.style.width = targetStyle.width;
        this._watermarkCanvas.style.height = targetStyle.height;
    }

    resize(width, height, screens) {
        this._canvas2D.resize(width, height, screens);
    }

    blitImage(x, y, width, height, arr, offset) {
        this._canvas2D.blitImage(x, y, width, height, arr, offset);
    }

    blitQoi(arr, x, y) {
        this._canvas2D.blitQoi(arr, x, y);
    }

    clearRect(x, y, width, height) {
        this._canvas2D.clearRect(x, y, width, height);
    }

    copyImage(oldX, oldY, newX, newY, w, h) {
        this._canvas2D.copyImage(oldX, oldY, newX, newY, w, h);
    }

    drawImage(img, x, y, w, h) {
        this._canvas2D.drawImage(img, x, y, w, h);
    }

    drawVideoFrame(frame, x, y, w, h) {
        const renderStart = perfLogger.start('webglRender');

        const gl = this.gl;
        const fbWidth = this._canvas2D._target.width;
        const fbHeight = this._canvas2D._target.height;

        // Resize WebGL canvas only when dimensions change
        if (this._lastWidth !== fbWidth || this._lastHeight !== fbHeight) {
            this._resizeWebGLCanvas(fbWidth, fbHeight);
        }

        // Upload frame to texture (GPU operation)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

        // Set viewport to video region (Y-flip for WebGL bottom-left origin)
        const glY = fbHeight - y - h;
        gl.viewport(x, glY, w, h);

        // Render quad
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

        // Close frame to release resources
        frame.close();

        perfLogger.end('webglRender', renderStart);
    }

    _resizeWebGLCanvas(fbWidth, fbHeight) {
        this._webglCanvas.width = fbWidth;
        this._webglCanvas.height = fbHeight;

        // Match style dimensions to target canvas
        const targetStyle = this._canvas2D._target.style;
        this._webglCanvas.style.width = targetStyle.width;
        this._webglCanvas.style.height = targetStyle.height;
        this._watermarkCanvas.style.width = targetStyle.width;
        this._watermarkCanvas.style.height = targetStyle.height;

        // Update viewport
        this.gl.viewport(0, 0, fbWidth, fbHeight);

        // Cache dimensions
        this._lastWidth = fbWidth;
        this._lastHeight = fbHeight;
    }

    fillRect(x, y, width, height, color) {
        this._canvas2D.fillRect(x, y, width, height, color);
    }

    _writeCtxBuffer() {
        this._canvas2D._writeCtxBuffer();
    }

    dispose() {
        const gl = this.gl;

        // Clean up WebGL resources
        if (this._texture) {
            gl.deleteTexture(this._texture);
            this._texture = null;
        }

        if (this._vertexBuffer) {
            gl.deleteBuffer(this._vertexBuffer);
            this._vertexBuffer = null;
        }

        if (this.shaderProgram) {
            gl.deleteProgram(this.shaderProgram);
            this.shaderProgram = null;
        }

        // Remove WebGL canvas from DOM
        if (this._webglCanvas?.parentNode) {
            this._webglCanvas.parentNode.removeChild(this._webglCanvas);
        }

        // Remove watermark canvas from DOM
        if (this._watermarkCanvas?.parentNode) {
            this._watermarkCanvas.parentNode.removeChild(this._watermarkCanvas);
        }

        // Dispose canvas2D
        this._canvas2D?.dispose();

        // Clear references
        this._canvas2D = null;
        this.gl = null;
        this._webglCanvas = null;
        this._watermarkCanvas = null;
        this._watermarkCtx = null;
    }
}
