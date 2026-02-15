import { Response } from "express";
import { loggers } from "./logger";

/**
 * Options for the drive error handler
 */
export interface DriveErrorOptions {
  /** Default message for 404 Not Found errors */
  notFoundDefault?: string;
  /** Default message for 409 Conflict errors */
  alreadyExistsDefault?: string;
  /** If false, only the default message is sent; if true (default), error.message is preferred */
  useErrorMsg?: boolean;
}

/**
 * Common error handler for drive routes to reduce duplication
 *
 * @param res Express response object
 * @param error The error object from a catch block
 * @param logMessage Message to log with the error
 * @param options Customization options for the response
 */
export function handleDriveError(
  res: Response,
  error: any,
  logMessage: string,
  options: DriveErrorOptions = {}
) {
  const {
    notFoundDefault = "Item not found",
    alreadyExistsDefault = "Item already exists",
    useErrorMsg = true,
  } = options;

  loggers.server.error({ err: error }, logMessage);

  const errorMessage = error?.message || "";

  // Handle 404 Not Found
  if (errorMessage.includes("does not exist")) {
    return res.status(404).json({
      success: false,
      error: useErrorMsg ? (errorMessage || notFoundDefault) : notFoundDefault,
    });
  }

  // Handle 409 Conflict
  if (errorMessage.includes("already exists")) {
    return res.status(409).json({
      success: false,
      error: useErrorMsg ? (errorMessage || alreadyExistsDefault) : alreadyExistsDefault,
    });
  }

  // Handle 500 Internal Server Error
  return res.status(500).json({
    success: false,
    error: errorMessage || "Internal Server Error",
  });
}
