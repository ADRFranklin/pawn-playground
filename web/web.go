package web

import "embed"

//go:embed *.html *.svg *.json *.js js/*.js css/*.css vendor icons
var FS embed.FS
