import FriendInviteAcceptSection from "../../../../components/features/friends/FriendInviteAcceptSection";

export default function FriendInvitePage({
  params
}: {
  params: { token: string };
}) {
  return <FriendInviteAcceptSection token={params.token} />;
}
