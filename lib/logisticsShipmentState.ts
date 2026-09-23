type ShipmentState = {
  status?: string | null;
  substatus?: string | null;
  date_first_printed?: string | null;
  logistic_type?: string | null;
  logistic?: { type?: string | null } | null;
};

export function logisticsLabelState(shipment: ShipmentState): "ready_to_print" | "printed" | null {
  const logistic = shipment.logistic?.type || shipment.logistic_type;
  if (!["cross_docking", "self_service"].includes(logistic || "") || shipment.status !== "ready_to_ship") return null;
  if (!["ready_to_print", "printed", "ready_for_pickup"].includes(shipment.substatus || "")) return null;
  return shipment.substatus === "ready_to_print" && !shipment.date_first_printed ? "ready_to_print" : "printed";
}
