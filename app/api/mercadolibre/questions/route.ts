import { NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import { createAdminClient } from "@/lib/supabaseAdmin";

type MeliQuestion = {
  id?: number;
  item_id?: string;
  text?: string;
  status?: string;
  date_created?: string;
  answer?: { text?: string; status?: string; date_created?: string } | null;
};

export async function GET(request: Request) {
  try {
    const account = await getConnectedMeliAccount();
    if (!account) return NextResponse.json({ error: "No hay una cuenta de Mercado Libre conectada." }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const status = String(searchParams.get("status") || "UNANSWERED").toUpperCase();
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || 50), 50));
    const response = await meliFetch(
      `/questions/search?seller_id=${account.meli_user_id}&status=${encodeURIComponent(status)}&limit=${limit}&api_version=4`,
      account,
    ) as { questions?: MeliQuestion[]; total?: number };
    const questions = response.questions || [];
    const itemIds = [...new Set(questions.map((question) => question.item_id).filter(Boolean))] as string[];
    const publications = itemIds.length
      ? await createAdminClient().from("mercadolibre_shipping_costs").select("meli_item_id, meli_title").in("meli_item_id", itemIds)
      : { data: [] as Array<{ meli_item_id: string | null; meli_title: string | null }> };
    const titles = new Map((publications.data || []).map((publication) => [publication.meli_item_id, publication.meli_title]));

    return NextResponse.json({
      total: Number(response.total || questions.length),
      questions: questions.map((question) => ({ ...question, item_title: titles.get(question.item_id || "") || null })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las preguntas." }, { status: 500 });
  }
}
