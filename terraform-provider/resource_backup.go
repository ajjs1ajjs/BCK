package main

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
)

type backupResource struct{}

func NewBackupResource() resource.Resource {
	return &backupResource{}
}

func (r *backupResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_backup"
}

func (r *backupResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a BCK Backup Job.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed:            true,
				Description:         "Unique identifier of the backup job",
			},
			"name": schema.StringAttribute{
				Required:            true,
				Description:         "Friendly name of the backup job",
			},
			"source": schema.StringAttribute{
				Required:            true,
				Description:         "Source identifier or path to backup (depends on type)",
			},
			"destination": schema.StringAttribute{
				Required:            true,
				Description:         "Destination path or target repository for backup storage",
			},
			"type": schema.StringAttribute{
				Required:            true,
				Description:         "Type of backup (e.g. mysql, postgres, host, vmware, hyperv)",
			},
			"backup_type": schema.StringAttribute{
				Optional:            true,
				Description:         "Local path or S3-compatible cloud upload",
			},
			"config": schema.StringAttribute{
				Optional:            true,
				Description:         "JSON-encoded configuration settings specific to the backup type",
			},
		},
	}
}

func (r *backupResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	// Call API: POST /api/backups
}

func (r *backupResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	// Call API: GET /api/backups/:id
}

func (r *backupResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	// Call API: PUT /api/backups/:id
}

func (r *backupResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	// Call API: DELETE /api/backups/:id
}
