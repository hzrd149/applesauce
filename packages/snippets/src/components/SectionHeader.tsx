interface SectionHeaderProps {
  title: string;
  icon: React.ReactNode;
}

export default function SectionHeader({ title, icon }: SectionHeaderProps) {
  return (
    <h3 className="font-semibold text-base flex items-center gap-2">
      {icon}
      {title}
    </h3>
  );
}
