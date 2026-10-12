const PACKETS = {
    DOCUMENT_START: 0,
    DOCUMENT_CHUNK: 1,
    DOCUMENT_END: 2
};

const printDocument = async (data) => {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    iframe.onload = () => {
        setTimeout(() => {
            iframe.focus();
            iframe.contentWindow.print();
        }, 1);
    };

    const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" });
    iframe.src = URL.createObjectURL(blob);
}

export default (rfb) => {
    let documentSize = 0;
    let downloadedSize = 0;
    // One document's chunks; emptied at every start and end, so a print
    // carries only its own bytes and never an earlier document's.
    let chunks = [];

    const processRelayData = (payload) => {
        const array = Array.from(payload);
        const buffer = new Uint8Array(array).buffer;
        const packetData = new DataView(buffer);
        const packetId = packetData.getUint32(0, false);

        switch (packetId) {
            case PACKETS.DOCUMENT_START:
                documentSize = packetData.getUint32(4, false);
                downloadedSize = 0;
                chunks = [];
                console.log(`Downloading document for printing (${documentSize}B)`);
                break;
            
            case PACKETS.DOCUMENT_CHUNK:
                let chunkSize = packetData.getUint32(4, false);
                let chunkData = new Uint8Array(buffer, 8);
                downloadedSize += chunkSize;
                chunks.push(chunkData);
                console.log(`Downloading document for printing (${downloadedSize}/${documentSize}B)`);
                break;
            
            case PACKETS.DOCUMENT_END:
                console.log(`Downloaded document for printing (${downloadedSize}/${documentSize}B)`);
                const documentData = new Uint8Array(downloadedSize);
                let offset = 0;
                for (const c of chunks) {
                    documentData.set(c, offset);
                    offset += c.length;
                }
                printDocument(documentData);
                chunks = [];
                downloadedSize = 0;
                documentSize = 0;
                break;

            default:
                console.error(`Unknown packet id: ${packetId}`);
                break;
        }
    }

    rfb.subscribeUnixRelay("printer", processRelayData);
}