// onboard-customer (spec 5.5): register a customer and explain the expected errors.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const onboardCustomerText = (a: { name: string; email: string; phone: string; segment: string }) =>
  `Register a new customer with createCustomer: name "${a.name}", email "${a.email}", phone "${a.phone}", segment "${a.segment}". ` +
  'If the tool returns [FORBIDDEN], explain that the configured token does not have the admin role and stop. ' +
  'If it returns [CONFLICT], tell me that another customer already uses this email.';

export function registerOnboardCustomerPrompt(server: McpServer): void {
  server.registerPrompt(
    'onboard-customer',
    {
      title: 'Onboard a customer',
      description: 'Register a new customer with createCustomer (admin role)',
      argsSchema: {
        name: z.string().describe('Full name or company name'),
        email: z.string().describe('Email; must not belong to another customer'),
        phone: z.string().describe('Brazilian phone in any common format'),
        segment: z.string().describe('retail, smb or enterprise'),
      },
    },
    (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: onboardCustomerText(args) } }] }),
  );
}
