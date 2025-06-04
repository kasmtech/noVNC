self.onmessage = (e) => {
        // Immediately forward to main thread
    const msg = e.data;
    self.postMessage({
        keysym: msg.keysym,
        code: msg.code,
        down: msg.down
    });
};