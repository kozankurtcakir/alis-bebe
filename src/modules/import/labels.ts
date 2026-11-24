export const rowLabels = {
  create: "Eklenecek",
  update: "Değişecek",
  skip: "Aynı",
  error: "Hatalı",
} as const;

export const statusLabel = (job: { status: string; invalid: number }) =>
  job.status === "applied"
    ? "Uygulandı"
    : job.status === "invalid"
      ? `${job.invalid} hatalı satır`
      : "Onay bekliyor";
