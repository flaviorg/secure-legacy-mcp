// Fixture format of the scripted fake model (spec 7.2), validated when loaded: an
// invalid fixture fails before the agent runs.
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const toolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});

const stepSchema = z.union([
  z.object({ toolCalls: z.array(toolCallSchema).min(1), ifUnresolved: z.string().min(1).optional() }).strict(),
  z.object({ final: z.string().min(1), ifUnresolved: z.string().min(1).optional() }).strict(),
]);

export const fixtureSchema = z.object({
  scenario: z.string().min(1),
  description: z.string().min(1),
  turns: z.array(z.object({ match: z.string().min(1), steps: z.array(stepSchema).min(1) })).min(1),
});

export type Fixture = z.infer<typeof fixtureSchema>;
export type FixtureStep = Fixture['turns'][number]['steps'][number];

export function loadFixture(path: string): Fixture {
  return fixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
