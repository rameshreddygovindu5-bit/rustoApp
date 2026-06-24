/**
 * Module-level Razorpay payload cache.
 * Stores the payload from booking creation so the checkout screen
 * doesn't need to re-create the booking to get payment details.
 *
 * Simple Map: booking_id -> RazorpayOrderPayload
 * Cleared after successful payment to prevent stale data.
 */
import { RazorpayOrderPayload } from "@/api/rusto";

export const razorpayCache = new Map<number, RazorpayOrderPayload>();
