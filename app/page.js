import { redirect } from "next/navigation";

// The legacy month-end close tracker has been retired — month-end now runs through
// the PERFORM weekly schedule. Home is the Finance OS.
export default function Home() {
  redirect("/finance-os/executive");
}
