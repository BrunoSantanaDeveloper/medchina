import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data, error } = await supabase.rpc("get_consultation_context", { target_consultation: id });
  if (error) return clinicalError("internal_error");
  return clinicalRpcResponse(data);
}
