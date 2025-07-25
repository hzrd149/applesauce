import { blueprint, TagOperation } from "applesauce-factory";
import { fillAndTrimTag } from "applesauce-factory/helpers";
import { includeSingletonTag, modifyPublicTags } from "applesauce-factory/operations";
import { RequestInput } from "../helpers/request.js";

/** Includes the input tags for a request */
export function includeRequestInputs(inputs: RequestInput[]): TagOperation {
  return async (tags, ctx) => {
    tags = Array.from(tags);

    for (const input of inputs) {
      switch (input.type) {
        case "url":
          tags.push(["i", input.url, "url"]);
          break;
        case "text":
          tags.push(["i", input.text, "text"]);
          break;
        case "job":
          tags.push(
            fillAndTrimTag(
              ["i", input.job, "job", input.relay || (await ctx.getEventRelayHint?.(input.job)), input.marker],
              3,
            ),
          );
          break;
        case "event":
          tags.push(
            fillAndTrimTag(
              ["i", input.event, "event", input.relay || (await ctx.getEventRelayHint?.(input.event)), input.marker],
              3,
            ),
          );
          break;
      }
    }

    return tags;
  };
}

/** Includes the request `param` tags */
export function includeRequestParams(params: Record<string, string | string[]>): TagOperation {
  return (tags) => {
    tags = Array.from(tags);

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") tags.push(["param", key, value]);
      else if (Array.isArray(value)) tags.push(...value.map((v) => ["param", key, v]));
    }
    return tags;
  };
}

export function MachineRequestBlueprint(
  kind: number,
  options?: {
    relays?: string[];
    inputs?: RequestInput[];
    params?: Record<string, string | string[]>;
  },
) {
  return blueprint(
    kind,
    modifyPublicTags(
      options?.inputs ? includeRequestInputs(options.inputs) : undefined,
      options?.params ? includeRequestParams(options.params) : undefined,
    ),
    options?.relays ? includeSingletonTag(["relays", ...options.relays]) : undefined,
  );
}
