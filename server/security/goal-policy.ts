export function goalPolicyAllows(value: unknown): boolean {
  return !/\b(?:diagnos\w*|prescrib\w*|stop (?:my )?medication|change (?:my )?(?:medication|dose)|starv\w*|purging|lowest body.fat|as fast as possible)\b/i.test(
    JSON.stringify(value),
  );
}
