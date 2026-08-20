import type { PublishResponse } from "applesauce-relay";

/** Structured failure for a required invite-revocation publication stage. */
export class InviteRevocationPublishError extends AggregateError {
  constructor(
    public readonly stage: string,
    public readonly responses: PublishResponse[],
    options?: ErrorOptions,
  ) {
    super(responses, `${stage} failed: no relay accepted the revocation`, options);
    this.name = "InviteRevocationPublishError";
  }
}

/** A multi-relay revocation is effective once any targeted relay accepts it. */
export function requireInviteRevocationAck(stage: string, responses: PublishResponse[]): void {
  if (responses.some((response) => response.ok)) return;
  throw new InviteRevocationPublishError(stage, responses);
}
