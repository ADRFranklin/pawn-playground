package wasm

import "embed"

//go:embed *.js *.wasm *.data
var FS embed.FS
