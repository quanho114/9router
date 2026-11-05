import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver";
import {
  getSupabaseSyncStatus,
  pullFromSupabase,
  pushToSupabase,
} from "@/lib/db/supabaseSync";

export async function GET() {
  try {
    await getAdapter();
    return NextResponse.json(getSupabaseSyncStatus());
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const adapter = await getAdapter();
    const body = await request.json().catch(() => ({}));
    const action = body.action || "push";

    if (action === "pull") {
      const result = await pullFromSupabase(adapter);
      return NextResponse.json({ ...result, status: getSupabaseSyncStatus() });
    }

    const result = await pushToSupabase(adapter);
    return NextResponse.json({ ...result, status: getSupabaseSyncStatus() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
