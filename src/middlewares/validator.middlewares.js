import { validationResult } from "express-validator";
import { ApiError } from "../utils/api-error.js";

export const validate = (req, res, next) => {
  const errors = validationResult(req);

  // ✅ If no validation errors, continue to the next middleware
  if (errors.isEmpty()) {
    return next();
  }

  // ✅ Collect all validation errors
  const extractedErrors = [];
  errors.array().map((err) =>
    extractedErrors.push({
      [err.path]: err.msg, // field: message
    })
  );


  throw new ApiError(422, "Received Data is not valid", extractedErrors);
};