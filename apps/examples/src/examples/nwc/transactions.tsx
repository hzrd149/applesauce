/**
 * View and manage wallet transaction history with filtering and details
 * @tags nip-47, nwc, wallet, transactions
 * @related nwc/simple-wallet, nwc/wallet-info
 */
import { publishEvent } from "../../extra/publish";

import { Subject, defer, map, startWith, catchError, of, exhaustMap, scan } from "rxjs";

import { hexToBytes } from "@noble/hashes/utils.js";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { WalletConnect } from "applesauce-wallet-connect";
import { parseWalletConnectURI, supportsMethod, Transaction } from "applesauce-wallet-connect/helpers";
import { useMemo, useState } from "react";

// Create a relay pool to make relay connections
const pool = new RelayPool();

function TransactionItem({ transaction }: { transaction: Transaction }) {
  const isIncoming = transaction.type === "incoming";
  const isSettled = transaction.state === "settled";
  const isPending = transaction.state === "pending";
  const isFailed = transaction.state === "failed";
  const isExpired = transaction.state === "expired";

  // Format amount from msats to sats
  const amountSats = Math.floor(transaction.amount / 1000);
  const feesSats = Math.floor(transaction.fees_paid / 1000);

  // Format timestamps
  const createdDate = new Date(transaction.created_at * 1000);
  const settledDate = transaction.settled_at ? new Date(transaction.settled_at * 1000) : null;
  const expiresDate = transaction.expires_at ? new Date(transaction.expires_at * 1000) : null;

  // Get status badge class
  const getStatusBadgeClass = () => {
    if (isSettled) return "badge-success";
    if (isPending) return "badge-warning";
    if (isFailed) return "badge-error";
    if (isExpired) return "badge-ghost";
    return "badge-outline";
  };

  return (
    <div className="w-full p-4 border border-base-300 rounded-lg bg-base-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isIncoming ? (isSettled ? "bg-success" : "bg-warning") : isSettled ? "bg-info" : "bg-warning"
            }`}
          />
          <div className={`badge ${isIncoming ? "badge-success" : "badge-info"}`}>
            {isIncoming ? "↓ Incoming" : "↑ Outgoing"}
          </div>
          <div className={`badge ${getStatusBadgeClass()}`}>{transaction.state}</div>
        </div>
        <div className="text-right">
          <div className={`font-bold text-lg ${isIncoming ? "text-success" : "text-info"}`}>
            {isIncoming ? "+" : "-"}
            {amountSats.toLocaleString()} sats
          </div>
          {feesSats > 0 && <div className="text-sm opacity-60">Fee: {feesSats.toLocaleString()} sats</div>}
        </div>
      </div>

      {transaction.description && (
        <div className="mb-3">
          <span className="font-medium">Description: </span>
          <span className="text-sm">{transaction.description}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm opacity-70 mb-2">
        <div>
          <span className="font-medium">Payment Hash: </span>
          <code className="break-all">{transaction.payment_hash}</code>
        </div>
        {transaction.preimage && (
          <div>
            <span className="font-medium">Preimage: </span>
            <code className="break-all">{transaction.preimage}</code>
          </div>
        )}
        {settledDate && (
          <div>
            <span className="font-medium">Settled: </span>
            {settledDate.toLocaleString()}
          </div>
        )}
        {expiresDate && !isSettled && (
          <div>
            <span className="font-medium">Expires: </span>
            {expiresDate.toLocaleString()}
          </div>
        )}
      </div>

      {transaction.metadata && Object.keys(transaction.metadata).length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-sm font-medium opacity-70">Metadata</summary>
          <pre className="text-sm mt-1 p-2 bg-base-300 rounded overflow-x-auto">
            {JSON.stringify(transaction.metadata, null, 2)}
          </pre>
        </details>
      )}

      <div className="text-sm opacity-60 mt-2 pt-2 border-t border-base-300">
        <time className="font-mono">{createdDate.toLocaleString()}</time>
      </div>
    </div>
  );
}

function TransactionTimeline({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-4xl opacity-20 mb-4">📝</div>
        <p className="text-lg opacity-60">No transactions found</p>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-2xl font-bold">Transactions</h2>
      <div className="space-y-2">
        {transactions.map((transaction, index) => (
          <TransactionItem key={`${transaction.payment_hash}-${index}`} transaction={transaction} />
        ))}
      </div>
    </>
  );
}

export default function TransactionsExample() {
  const [uri, setUri] = useState("");

  const [transactionType, setTransactionType] = useState<"incoming" | "outgoing" | undefined>(undefined);

  const [includeUnpaid, setIncludeUnpaid] = useState(false);

  const parseResult = useMemo(() => {
    if (!uri.trim()) return { parsed: null, error: null };
    try {
      return { parsed: parseWalletConnectURI(uri), error: null };
    } catch (error) {
      return { parsed: null, error: String(error) };
    }
  }, [uri]);
  const parsed = parseResult.parsed;
  const handleUriChange = (value: string) => setUri(value);
  // Create WalletConnect instance
  const wallet = useMemo(() => {
    if (!parsed) return undefined;

    try {
      const secret = hexToBytes(parsed.secret);
      const walletConnect = new WalletConnect({
        ...parsed,
        secret,
        subscriptionMethod: pool.subscription.bind(pool),
        publishMethod: (relays, event) => publishEvent(pool, relays, event),
      });

      return walletConnect;
    } catch (err) {
      console.error("Failed to create wallet connection:", err);
      return undefined;
    }
  }, [parsed]);

  // Get wallet capabilities to check if list_transactions is supported
  const support = use$(() => wallet?.support$, [wallet]);

  const pageSize = 20;
  const fetch$ = useMemo(() => new Subject<{ page: number; append: boolean }>(), []);
  type Result = { transactions: Transaction[]; loading: boolean; error: string | null; page: number; hasMore: boolean };
  const result = use$(
    () =>
      fetch$.pipe(
        exhaustMap(({ page, append }) => {
          if (!wallet || !support || !supportsMethod(support, "list_transactions"))
            return of<Result>({
              transactions: [],
              loading: false,
              error: "list_transactions is unavailable",
              page: 0,
              hasMore: false,
            });
          return defer(() =>
            wallet.listTransactions({
              limit: pageSize,
              offset: page * pageSize,
              type: transactionType,
              unpaid: includeUnpaid,
            }),
          ).pipe(
            map((response) => ({
              page,
              append,
              transactions: response.transactions,
              loading: false,
              error: null as string | null,
              hasMore: response.transactions.length === pageSize,
            })),
            startWith({ page, append, transactions: [] as Transaction[], loading: true, error: null, hasMore: true }),
            catchError((error) =>
              of({
                page,
                append,
                transactions: [] as Transaction[],
                loading: false,
                error: String(error),
                hasMore: true,
              }),
            ),
          );
        }),
        scan(
          (previous: Result, next) => ({
            ...next,
            transactions:
              next.loading || next.error
                ? previous.transactions
                : "append" in next && next.append
                  ? [...previous.transactions, ...next.transactions]
                  : next.transactions,
          }),
          { transactions: [], loading: false, error: null, page: 0, hasMore: true } as Result,
        ),
      ),
    [wallet, support, transactionType, includeUnpaid, fetch$],
  );
  const transactions = result?.transactions ?? [];
  const loading = result?.loading ?? false;
  const hasMore = result?.hasMore ?? true;
  const currentPage = result?.page ?? 0;
  const error = parseResult.error || result?.error;
  const methodError =
    support && !supportsMethod(support, "list_transactions") ? "list_transactions is unsupported" : null;
  const fetchTransactions = (page = 0, append = false) => fetch$.next({ page, append });
  const refresh = () => fetchTransactions();
  const loadMore = () => {
    if (!loading && hasMore) fetchTransactions(currentPage + 1, true);
  };
  const handleTypeChange = (type: "incoming" | "outgoing" | undefined) => setTransactionType(type);
  const handleUnpaidChange = (unpaid: boolean) => setIncludeUnpaid(unpaid);

  return (
    <div className="container mx-auto my-8 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Transaction History</h1>
        <p className="mb-4 opacity-70">
          Enter a nostr+walletconnect URI to connect to a wallet and view its transaction history using the
          list_transactions method.
        </p>

        {/* URI Input */}
        <div className="mb-8">
          <label className="label">
            <span className="label-text">Wallet Connect URI</span>
          </label>
          <textarea
            value={uri}
            onChange={(e) => handleUriChange(e.target.value)}
            placeholder="nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=secretkey"
            className="textarea textarea-bordered w-full"
            rows={3}
          />
          {error && <p className="mt-2 text-sm text-error">{error}</p>}
        </div>

        {/* Connection Status and Actions */}
        {parsed && (
          <div className="my-4 space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-4 items-center my-4">
              <div className="flex flex-col gap-2">
                <label className="label">
                  <span className="label-text">Transaction Type</span>
                </label>
                <select
                  className="select select-bordered select-sm"
                  value={transactionType || "all"}
                  onChange={(e) =>
                    handleTypeChange(e.target.value === "all" ? undefined : (e.target.value as "incoming" | "outgoing"))
                  }
                >
                  <option value="all">All</option>
                  <option value="incoming">Incoming</option>
                  <option value="outgoing">Outgoing</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="label cursor-pointer">
                  <span className="label-text mr-2">Include Unpaid</span>
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={includeUnpaid}
                    onChange={(e) => handleUnpaidChange(e.target.checked)}
                  />
                </label>
              </div>

              <div className="join ms-auto">
                <button onClick={refresh} disabled={loading} className="btn join-item btn-primary">
                  {loading ? (
                    <>
                      <span className="loading loading-spinner loading-sm mr-2"></span>
                      Loading...
                    </>
                  ) : (
                    "Fetch Transactions"
                  )}
                </button>

                {transactions.length > 0 && (
                  <button onClick={refresh} disabled={loading} className="btn join-item btn-outline">
                    Refresh
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Method Not Supported Warning */}
        {methodError && (
          <div className="alert alert-warning mb-8">
            <div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="stroke-current shrink-0 h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.996-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div>
                <h3 className="font-bold">Method Not Supported</h3>
                <div className="text-sm">{methodError}</div>
              </div>
            </div>
          </div>
        )}

        {/* Transaction Display */}
        {transactions.length > 0 && (
          <>
            <TransactionTimeline transactions={transactions} />

            {/* Load More Button */}
            {hasMore && (
              <div className="text-center mt-6">
                <button onClick={loadMore} disabled={loading} className="btn btn-outline btn-wide">
                  {loading ? (
                    <>
                      <span className="loading loading-spinner loading-sm mr-2"></span>
                      Loading more...
                    </>
                  ) : (
                    "Load More"
                  )}
                </button>
              </div>
            )}

            {/* Transaction Count Info */}
            <div className="text-center mt-4 opacity-60">
              <p className="text-sm">
                Showing {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
                {!hasMore && transactions.length > pageSize && " (all loaded)"}
              </p>
            </div>
          </>
        )}

        {/* Empty State */}
        {transactions.length === 0 && !loading && support && !methodError && (
          <div className="text-center py-12">
            <div className="text-6xl opacity-20 mb-4">💸</div>
            <p className="text-xl opacity-60 mb-2">No transactions yet</p>
            <p className="opacity-40">Connect to a wallet and fetch transactions to see them here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
