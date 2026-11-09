import logo from '../../../../resources/icon.png'

export function TitleBar() {
  return (
    <header className="drag-region flex h-10 shrink-0 items-center gap-2.5 border-b bg-sidebar pl-4">
      <img src={logo} alt="" className="size-5 rounded-[5px]" />
      <span className="text-[13px] font-semibold tracking-tight">LLorostini</span>
    </header>
  )
}
