// Small presentational helpers shared by the expenses screens.
import type { ReactNode } from 'react'
import { Receipt, ShoppingBag, Store, Truck, Users, Utensils, Zap } from 'lucide-react'
import type { ExpenseCategory } from '../../types'
import { EXPENSE_CATEGORY_LABEL } from '../../constants'

const ICONS: Record<ExpenseCategory, (size: number) => ReactNode> = {
  rent: (s) => <Store size={s} />,
  electric: (s) => <Zap size={s} />,
  wage: (s) => <Users size={s} />,
  supplies: (s) => <ShoppingBag size={s} />,
  travel: (s) => <Truck size={s} />,
  food: (s) => <Utensils size={s} />,
  other: (s) => <Receipt size={s} />,
}

export function categoryLabel(c: ExpenseCategory | null | undefined): string {
  return (c && EXPENSE_CATEGORY_LABEL[c]) || EXPENSE_CATEGORY_LABEL.other
}

export function CategoryIcon({ category, size = 20 }: { category: ExpenseCategory | null | undefined; size?: number }) {
  const render = (category && ICONS[category]) || ICONS.other
  return (
    <span className={`list-icon exp-cat-icon exp-cat-${category && ICONS[category] ? category : 'other'}`} aria-hidden="true">
      {render(size)}
    </span>
  )
}
