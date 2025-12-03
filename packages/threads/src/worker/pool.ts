/// <reference lib="webworker" />

import { RelayPool } from "applesauce-relay/pool";
import { connectWorkerRPCServer } from "../common/worker.js";
import { createPoolWorkerRPC } from "../pool/worker/rpc.js";

// Create a relay pool
const pool = new RelayPool();

// Create the RPC server for the pool worker
const server = createPoolWorkerRPC(pool);

// Connect the RPC server to handle messages
connectWorkerRPCServer(server, "pool");
