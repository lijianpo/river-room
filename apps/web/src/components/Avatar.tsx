export function Avatar({ src, name, className = '' }: { src: string; name: string; className?: string }) {
  return <img className={`user-avatar ${className}`} src={src} alt={`${name} 的头像`} loading="lazy" />;
}
