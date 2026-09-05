import { createRequestListener } from "@mjackson/node-fetch-server";
import { createRequestHandler } from "react-router";
import * as build from "../build/server/index.js";

const handleRequest = createRequestHandler(build, "production");

export default createRequestListener(handleRequest);