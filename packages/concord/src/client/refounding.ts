import { mergeRelaySets, normalizeRelayUrl } from "applesauce-core/helpers/relays";
import type { PublishResponse } from "applesauce-relay";

export type RefoundingArtifactKind = "root-rekey" | "channel-rekey" | "control-compaction" | "guestbook-snapshot";

export interface RefoundingArtifact {
  /** Stable signed event identifier; never secret-bearing event content. */
  id: string;
  kind: RefoundingArtifactKind;
}

export interface RefoundingArtifactPublication {
  artifact: RefoundingArtifact;
  responses: PublishResponse[];
  /** Original rejected publish cause, retained programmatically but never formatted. */
  cause?: unknown;
}

export type RefoundingRelayStatus = "accepted" | "rejected" | "missing" | "publish-failed";

export interface RefoundingRelayEvidence {
  relay: string;
  status: RefoundingRelayStatus;
}

export interface RefoundingArtifactEvidence {
  artifact: RefoundingArtifact;
  acceptedRelays: string[];
  relays: RefoundingRelayEvidence[];
  causes: unknown[];
}

export interface RefoundingCoverage {
  accepted: boolean;
  protocolRelays: string[];
  required: number;
  commonRelays: string[];
  evidence: RefoundingArtifactEvidence[];
}

export interface RefoundingWarning {
  kind: "guestbook-snapshot-publication";
  rotationId: string;
  artifactIds: string[];
  evidence: RefoundingArtifactEvidence[];
  causes: unknown[];
}

export interface RefoundingResult {
  rotationId: string;
  epoch: number;
  warnings: RefoundingWarning[];
  evidence: RefoundingArtifactEvidence[];
  commonRelays: string[];
}

function normalizeOrigin(from: string | undefined): string | undefined {
  if (!from) return undefined;
  try {
    return normalizeRelayUrl(from);
  } catch {
    return undefined;
  }
}

/** Evaluate whether one strict majority of protocol relays accepted every artifact. */
export function evaluateCommonRelayCoverage(
  publications: RefoundingArtifactPublication[],
  configuredProtocolRelays: string[],
): RefoundingCoverage {
  const protocolRelays = mergeRelaySets(configuredProtocolRelays);
  const protocolSet = new Set(protocolRelays);
  const required = Math.floor(protocolRelays.length / 2) + 1;
  const evidence = publications.map(({ artifact, responses, cause }) => {
    const responseByRelay = new Map<string, PublishResponse>();
    for (const response of responses) {
      const relay = normalizeOrigin(response.from);
      if (relay && protocolSet.has(relay)) responseByRelay.set(relay, response);
    }
    const relays = protocolRelays.map((relay): RefoundingRelayEvidence => {
      const response = responseByRelay.get(relay);
      return {
        relay,
        status: cause !== undefined ? "publish-failed" : response?.ok === true ? "accepted" : response ? "rejected" : "missing",
      };
    });
    const causes = [
      ...(cause === undefined ? [] : [cause]),
      ...responses.flatMap((response) => (response.error === undefined ? [] : [response.error])),
    ];
    return {
      artifact,
      acceptedRelays: relays.filter(({ status }) => status === "accepted").map(({ relay }) => relay),
      relays,
      causes,
    };
  });
  const commonRelays = protocolRelays.filter((relay) => evidence.every((row) => row.acceptedRelays.includes(relay)));
  return { accepted: publications.length > 0 && commonRelays.length >= required, protocolRelays, required, commonRelays, evidence };
}

export class RefoundingPublicationError extends AggregateError {
  readonly failedArtifactIds: string[];
  readonly causes: unknown[];

  constructor(
    public readonly rotationId: string,
    public readonly evidence: RefoundingArtifactEvidence[],
  ) {
    const causes = evidence.flatMap((row) => row.causes);
    super(causes, `refounding publication failed: common relay majority missing for rotation ${rotationId}`);
    this.name = "RefoundingPublicationError";
    this.causes = causes;
    this.failedArtifactIds = evidence
      .filter((row) => row.causes.length > 0 || row.relays.some(({ status }) => status !== "accepted"))
      .map((row) => row.artifact.id);
  }
}
