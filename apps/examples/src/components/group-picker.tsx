import { useEffect, useState } from "react";

export default function GroupPicker({
  identifier,
  setIdentifier,
}: {
  identifier: string;
  setIdentifier: (identifier: string) => void;
}) {
  const [input, setInput] = useState(identifier);
  useEffect(() => setInput(identifier), [identifier]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIdentifier(input);
  };

  return (
    <div className="join">
      <select className="select join-item w-48" onChange={(e) => setIdentifier(e.target.value)} value={identifier}>
        <option value="">Select group</option>
        <option value="groups.0xchat.com'chachi">chachi</option>
        <option value="groups.hzrd149.com'0a3991">blossom</option>
        <option value="relay.groups.nip29.com'Miz7w4srsmygbqy2">zap.stream</option>
        <option value="groups.0xchat.com'925b1aa20cd1b68dd9a0130e35808d66772fe082cf3f95294dd5755c7ea1ed59">
          Robosats
        </option>
        <option value="groups.hzrd149.com'a45b2f">applesauce</option>
        <option value="groups.hzrd149.com'79dc07">test group</option>
      </select>
      <form className="join-item flex grow" onSubmit={handleSubmit}>
        <input
          className="input input-bordered w-full min-w-xs"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter group identifier"
        />
        <button type="submit" className="btn btn-primary join-item">
          Load
        </button>
      </form>
    </div>
  );
}
