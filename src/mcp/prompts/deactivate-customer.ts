// deactivate-customer (spec 5.5 and 5.9): resolve, confirm with the user, then write.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const deactivateCustomerText = (who: string) =>
  `Deactivate the customer "${who}" following these steps:\n` +
  '1. Resolve the customer with getCustomer.\n' +
  '2. If the match is not "found", stop and ask me to clarify.\n' +
  "3. Show the customer's name, email and id and ask me to confirm.\n" +
  '4. Only after I confirm, call deactivateCustomer with that id.';

export function registerDeactivateCustomerPrompt(server: McpServer): void {
  server.registerPrompt(
    'deactivate-customer',
    {
      title: 'Deactivate a customer',
      description: 'Resolve the customer, ask for confirmation, then call deactivateCustomer (admin role)',
      argsSchema: { who: z.string().describe('The customer to deactivate: id, email, phone or name') },
    },
    ({ who }) => ({ messages: [{ role: 'user', content: { type: 'text', text: deactivateCustomerText(who) } }] }),
  );
}
