import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarColor, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  avatarPath?: string | null;
  className?: string;
}

export function UserAvatar({ name, avatarPath, className }: Props) {
  return (
    <Avatar className={className}>
      {avatarPath ? <AvatarImage src={avatarPath} alt={name} /> : null}
      <AvatarFallback className={cn(avatarColor(name))}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
