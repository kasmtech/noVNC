# Overview
This fork of noVNC is designed to work with KasmVNC, which has an embedded web server. It will not work with other VNC servers and does not strictly follow the RFB protocol.

## Dev Environment Setup
Install KasmVNC or use a Kasm Workspaces container. Remove the installed www directory, clone the git repository, and finally modify the JS so that it runs directly without the webpack

```bash
cd /usr/share/kasmvnc
sudo rm -rf www
sudo git clone https://github.com/kasmtech/noVNC.git www
sudo chown -R user:user www
cd www
sed -i "s#base.css\">#base.css\">\n    <script type="module" src="vendor/interact.min.js"></script>#" index.html
sed -i 's#import "core-js/stable";#//import "core-js/stable";#' app/ui.js
sed -i 's#import "regenerator-runtime/runtime";#//import "regenerator-runtime/runtime";#' app/ui.js
sed -i 's#\(import.\+@interactjs\)#//\1#' app/ui.js

```

Now connect to https://address/index.html, create a symlink if you need it to be index.html

## Before Commiting Changes
Undo the HTML/JS changes that allow you to run the code directly without the webpack.

```bash
cd /usr/share/kasmvnc/www
sed -i '/interact.min.js/d' index.html
sed -i 's#//import "core-js/stable";#import "core-js/stable";#' app/ui.js
sed -i 's#//import "regenerator-runtime/runtime";#import "regenerator-runtime/runtime";#' app/ui.js
sed -i 's#//\(import.\+@interactjs\)#\1#' app/ui.js
```
