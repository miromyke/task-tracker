import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarColor, avatarInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  // When the structured name is available (#19), pass it so initials come from
  // first + surname explicitly rather than a heuristic over `name`.
  firstName?: string;
  surname?: string;
  avatarPath?: string | null;
  className?: string;
}

export function UserAvatar({ name, firstName, surname, avatarPath, className }: Props) {
  return (
    <Avatar className={className}>
      {avatarPath ? <AvatarImage src={avatarPath} alt={name} /> : null}
      <AvatarFallback className={cn(avatarColor(name))}>
        {avatarInitials(firstName, surname, name)}
      </AvatarFallback>
    </Avatar>
  );
}
