import {Canvas2DRenderer} from "./Canvas2DRenderer";
import * as Log from "../util/logging";

export class WebGLRenderer {
    static vertexShaderSource = `
    attribute vec2 xy;

    varying highp vec2 uv;

    void main(void) {
      gl_Position = vec4(xy, 0.0, 1.0);
      // Map vertex coordinates (-1 to +1) to UV coordinates (0 to 1).
      // UV coordinates are Y-flipped relative to vertex coordinates.
      uv = vec2((1.0 + xy.x) / 2.0, (1.0 - xy.y) / 2.0);
    }
  `;

    static fragmentShaderSource = `
    varying highp vec2 uv;

    uniform sampler2D texture;

    void main(void) {
      gl_FragColor = texture2D(texture, uv);
    }
  `;

    constructor(canvas2D, gl) {
        this._canvas2D = canvas2D;
        this.gl = gl;
        this._webglCanvas = webglCanvas;

        Log.Info("WebGL Renderer Initialized");
        Log.Info("WebGL Version: " + gl.getParameter(gl.VERSION));
        Log.Info("WebGL Color: " + gl.getParameter(gl.RED_BITS) + ", " + gl.getParameter(gl.GREEN_BITS) + ", " + gl.getParameter(gl.BLUE_BITS) + ", " + gl.getParameter(gl.ALPHA_BITS))
        Log.Info("WebGL Depth: " + gl.getParameter(gl.DEPTH_BITS) + ", Stencil: " + gl.getParameter(gl.STENCIL_BITS));
        Log.Info("WebGL GLSL Version: " + gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
        Log.Info("WebGL Vendor: " + gl.getParameter(gl.VENDOR));
        Log.Info("WebGL Renderer: " + gl.getParameter(gl.RENDERER));
        Log.Info("WebGL Max Texture Size: " + gl.getParameter(gl.MAX_TEXTURE_SIZE));
        Log.Info("WebGL Max Vertex Attrib: " + gl.getParameter(gl.MAX_VERTEX_ATTRIBS));
        Log.Info("WebGL Extensions: " + gl.getSupportedExtensions());

        const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, WebGLRenderer.vertexShaderSource);
        const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, WebGLRenderer.fragmentShaderSource);

        this.shaderProgram = gl.createProgram();
        gl.attachShader(this.shaderProgram, vertexShader);
        gl.attachShader(this.shaderProgram, fragmentShader);
        gl.linkProgram(this.shaderProgram);
        if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
            throw gl.getProgramInfoLog(this.shaderProgram);
        }
        gl.useProgram(this.shaderProgram);

        // Vertex coordinates, clockwise from bottom-left.
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0,
            -1.0, +1.0,
            +1.0, +1.0,
            +1.0, -1.0
        ]), gl.STATIC_DRAW);

        const xyLocation = gl.getAttribLocation(this.shaderProgram, "xy");
        gl.vertexAttribPointer(xyLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(xyLocation);

        // Create one texture to upload frames to.
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    }

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

    compileShader(gl, type, source) {
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

    drawTransparentOverlayImg() {
        this._canvas2D.drawTransparentOverlayImg();
    }

    viewportChangeSize(width, height) {
        return this._canvas2D.viewportChangeSize(width, height);
    }

    rescale(factor, width, height, serverWidth, serverHeight, viewPortWidth) {
        this._canvas2D.rescale(factor, width, height, serverWidth, serverHeight, viewPortWidth);
    }

    resize(width, height, screens) {
        this._canvas2D.resize(width, height, screens);
    }

    //

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
        const gl = this.gl;

        // Upload the frame to texture
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        frame.close();

        // Set viewport to match the video region where we want to draw
        gl.viewport(x, this._webglCanvas.height - y - h, w, h);

        // Clear with transparent background so Canvas2D shows through
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Draw the frame
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }

    fillRect(x, y, width, height, color) {
        this._canvas2D.fillRect(x, y, width, height, color);
    }

    _writeCtxBuffer() {
        this._canvas2D._writeCtxBuffer();
    }

    dispose() {
        // Remove WebGL canvas from DOM
        if (this._webglCanvas && this._webglCanvas.parentNode) {
            this._webglCanvas.parentNode.removeChild(this._webglCanvas);
        }
        this._canvas2D.dispose();
    }
}