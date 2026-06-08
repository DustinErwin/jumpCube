import "./discordButton.css";

/*
 * DiscordButton renders an external community link.
 *
 * No props currently. If the invite changes, update the href below.
 */
export default function Intro() {
  return (
    <div className="cta-wrap">
      <a
        href="https://discord.gg/eSTWbtJ59g"
        target="_blank"
        rel="noopener noreferrer"
        className="join-discord"
      >
        Join the Discord
      </a>
    </div>
  );
}
