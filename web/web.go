package web

import "embed"

//go:embed *.html *.svg js/*.js css/*.css
var FS embed.FS
