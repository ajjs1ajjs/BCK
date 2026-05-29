package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
)

func main() {
	var debug bool

	flag.BoolVar(&debug, "debug", false, "set to true to run the provider with support for debuggers")
	flag.Parse()

	opts := providerserver.ServeOpts{
		Address: "registry.terraform.io/bck-backup/bck",
	}

	err := providerserver.Serve(context.Background(), New, opts)

	if err != nil {
		log.Fatal(err.Error())
	}
}
