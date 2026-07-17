import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

type FinalizeBody = { expectedRevision?: number | null; acknowledgedWarnings?: string[] };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as FinalizeBody;
  const expectedRevision = Number.isInteger(body.expectedRevision) ? Number(body.expectedRevision) : null;
  const acknowledgedWarnings = Array.isArray(body.acknowledgedWarnings)
    ? body.acknowledgedWarnings.filter((value): value is string => typeof value === "string")
    : [];

  const { data, error } = await supabase.rpc("finalize_consultation", {
    target_consultation: id,
    expected_revision: expectedRevision,
    acknowledged_warnings: acknowledgedWarnings,
  });
  if (error) return clinicalError("internal_error");

  return clinicalRpcResponse(data);
}
