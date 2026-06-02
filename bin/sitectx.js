#!/usr/bin/env node

import { runCli } from "../src/cli/index.js";

const exitCode = await runCli(process.argv);
process.exitCode = exitCode;
