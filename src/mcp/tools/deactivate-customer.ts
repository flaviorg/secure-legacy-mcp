// deactivateCustomer (spec 5.4): sets the status to inactive, autonomy band 3 (the MCP
// client should ask for confirmation). Physical delete and reactivation do not exist.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CustomerService } from '../application/customer-service.ts';
import { deactivateInput, deactivateOutput } from '../domain/customer.ts';
import { defineTool } from './define-tool.ts';
import type { ToolDeps } from './define-tool.ts';

const DEACTIVATE_CUSTOMER_DESCRIPTION =
  'Mark a customer as inactive by id (resolve the id with getCustomer and confirm with the user first). Requires the admin role. ' +
  'Idempotent: an already inactive customer returns alreadyInactive=true. ' +
  'There is no delete and no reactivation.';

export function registerDeactivateCustomerTool(server: McpServer, deps: { service: CustomerService } & ToolDeps): void {
  defineTool(server, deps, {
    name: 'deactivateCustomer',
    description: DEACTIVATE_CUSTOMER_DESCRIPTION,
    inputSchema: deactivateInput,
    outputSchema: deactivateOutput,
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: (input, ctx) => deps.service.deactivate(input, ctx),
  });
}
