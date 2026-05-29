package main

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
)

type scheduleResource struct{}

func NewScheduleResource() resource.Resource {
	return &scheduleResource{}
}

func (r *scheduleResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_schedule"
}

func (r *scheduleResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages an automated backup schedule.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed:            true,
				Description:         "Unique identifier of the schedule",
			},
			"name": schema.StringAttribute{
				Required:            true,
				Description:         "Name of the schedule",
			},
			"cron_expression": schema.StringAttribute{
				Required:            true,
				Description:         "Standard crontab syntax schedule (e.g. '0 0 * * *')",
			},
			"backup_id": schema.StringAttribute{
				Required:            true,
				Description:         "Target Backup Job ID to trigger",
			},
			"enabled": schema.BoolAttribute{
				Optional:            true,
				Description:         "Enable or disable the schedule (default true)",
			},
			"notify_on": schema.StringAttribute{
				Optional:            true,
				Description:         "Notification trigger: always, failure, never",
			},
			"description": schema.StringAttribute{
				Optional:            true,
				Description:         "Description of the schedule",
			},
		},
	}
}

func (r *scheduleResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	// Call API: POST /api/schedules
}

func (r *scheduleResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	// Call API: GET /api/schedules/:id
}

func (r *scheduleResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	// Call API: PUT /api/schedules/:id
}

func (r *scheduleResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	// Call API: DELETE /api/schedules/:id
}
