import { notFound } from "next/navigation";

// Keep unknown site URLs inside the locale layout and its branded 404 boundary.
// More specific routes (including /docs and API handlers) retain precedence.
export default function MissingPage() {
  notFound();
}
