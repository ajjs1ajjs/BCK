package main

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
)

func New() provider.Provider {
	return &bckProvider{}
}

type bckProvider struct{}

func (p *bckProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "bck"
}

func (p *bckProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"endpoint": schema.StringAttribute{
				Required:            true,
				Description:         "BCK API Endpoint URL (e.g. http://localhost:9000)",
			},
			"token": schema.StringAttribute{
				Required:            true,
				Sensitive:           true,
				Description:         "API token created in the BCK UI",
			},
		},
	}
}

func (p *bckProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	// Provider configuration logic (instantiate API client with endpoint and token)
}

func (p *bckProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewBackupResource,
		NewScheduleResource,
	}
}

func (p *bckProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return nil
}
