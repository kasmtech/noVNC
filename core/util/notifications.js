export function showNotification(message) {
    const elem = document.getElementById('noVNC_notification_overlay');
    let options = ["show"];
    if (message.length > 1) options.push("wide");
    elem.classList.add(...options);
    elem.innerHTML = message;
    setTimeout(() => {
        elem.classList.remove(...options);
    }, 3500);
}