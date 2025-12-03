import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { ISigner } from "applesauce-signers";
import { Observable } from "rxjs";

/** A signer class that proxies requests to another signer that isn't created yet */
export class ProxySigner<T extends ISigner> implements ISigner {
  private _signer: T | undefined;
  protected get signer(): T {
    if (!this._signer) throw new Error(this.error || "Missing signer");
    return this._signer;
  }

  get nip04() {
    if (!this.signer.nip04) throw new Error("Signer does not support nip04");
    return this.signer.nip04;
  }

  get nip44() {
    if (!this.signer.nip44) throw new Error("Signer does not support nip44");
    return this.signer.nip44;
  }

  constructor(
    protected upstream: Observable<T | undefined>,
    protected error?: string,
  ) {
    this.upstream.subscribe((signer) => (this._signer = signer));
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    return this.signer.signEvent(template);
  }
  async getPublicKey(): Promise<string> {
    return this.signer.getPublicKey();
  }
}
