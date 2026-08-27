import { ROLE_LABELS, type Role } from "@fym/shared";
import { Badge } from "./ui/badge";

const ROLE_VARIANTS: Record<Role, "default" | "info" | "neutral" | "success"> = {
  admin: "default",
  dispatcher: "info",
  warehouse: "neutral",
  driver: "success",
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={ROLE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>;
}
